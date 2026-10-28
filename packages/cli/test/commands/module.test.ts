/**
 * `forge module <list|info|add|remove|update>` (`19` §19.5, `PLAN-M11.md` P5).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
// Test-only (`*.test.ts` files are exempted from the "no bare tmpdir" rule — see
// `packages/extensions/test/install/npm-fixture-registry.ts`'s own identical note).
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Writable } from 'node:stream';

import { execa } from 'execa';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ManifestLockFenceLostError,
  moduleAdd,
  moduleInfo,
  moduleList,
  moduleRemove,
  moduleUpdate,
  readManifestDocument,
  withManifestLock,
  type InstallOptions,
  type ModuleCommandContext,
} from '../../src/commands/module.ts';
import {
  gateCheck,
  gateList,
  type GateCommandContext,
} from '../../src/commands/run/gate-commands.ts';
import {
  cleanupAll,
  createTestProject,
  registerCleanup,
  type TestProject,
} from './upgrade/helpers.ts';

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
  /** `module.yaml`'s own `provides` block — `{}` by default (nothing for `PLAN-M11.md` P6's own
   * conformance runner to check), overridable so a test can exercise its real refusal path. */
  readonly provides?: Record<string, readonly string[]>;
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
    forgeVersion: overrides.forgeVersion ?? '>=1.0 <2',
    requires: overrides.requires ?? [],
    conflicts: overrides.conflicts ?? [],
    levels: ['L1'],
    ceilings: overrides.ceilings ?? {},
    provides: overrides.provides ?? {},
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

/** A real, genuinely-dead pid — spawned then confirmed exited — standing in for a rival process whose
 * own independently-successful lock-file create has since landed, the identical technique
 * `collection-lock.test.ts`'s own `realDeadPid` already establishes for this exact anomaly-injection
 * shape. A real, once-live, now-dead pid (never a fabricated number) keeps this honest about what a
 * real pid actually looks like on disk. */
async function realDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process has no pid');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

function nullWritable(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function installOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  const consent =
    overrides.consent === undefined ? undefined : { output: nullWritable(), ...overrides.consent };
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
      YAML.stringify({
        id: 'acme-overlay',
        name: 'Acme',
        version: '1.0.0',
        forgeVersion: '>=1.0 <2',
      }),
    );

    await expect(
      moduleAdd(ctx, 'acme-overlay', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-043' });
  });

  it('refuses a bundle whose provides names an agent file that does not exist (CFG-050, PLAN-M11.md P6), installing nothing', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod', provides: { agents: ['ghost'] } });

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-050' });
    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod'))).toBe(false);
  });

  it('refuses a bundle whose own tests/*.test.ts fails (CFG-051, PLAN-M11.md P6), installing nothing', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod' });
    await mkdir(path.join(bundleDir, 'tests'), { recursive: true });
    await writeFile(
      path.join(bundleDir, 'tests', 'fail.test.ts'),
      "import { describe, it, expect } from 'vitest';\n" +
        "describe('conformance', () => { it('fails', () => { expect(1).toBe(2); }); });\n",
    );
    const workDir = await tempDir('forge-module-workdir-');

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true }, workDir })),
    ).rejects.toMatchObject({ code: 'CFG-051' });
    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod'))).toBe(false);
  }, 30_000);

  it('installs a bundle whose real provides and real, passing tests/*.test.ts both satisfy conformance (PLAN-M11.md P6)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod', provides: { agents: ['tester'] } });
    await mkdir(path.join(bundleDir, 'agents'), { recursive: true });
    await writeFile(path.join(bundleDir, 'agents', 'tester.agent.yaml'), 'id: tester\n');
    await mkdir(path.join(bundleDir, 'tests'), { recursive: true });
    await writeFile(
      path.join(bundleDir, 'tests', 'pass.test.ts'),
      "import { describe, it, expect } from 'vitest';\n" +
        "import { FakePlatformAdapter } from '@forge/testkit';\n" +
        "describe('conformance', () => { it('constructs a real fake adapter', async () => {\n" +
        '  const adapter = new FakePlatformAdapter();\n' +
        '  expect((await adapter.capabilities()).mcp).toBe(true);\n' +
        '}); });\n',
    );
    const workDir = await tempDir('forge-module-workdir-');

    const report = await moduleAdd(
      ctx,
      'acme-mod',
      bundleDir,
      installOptions({ consent: { yes: true }, workDir }),
    );
    expect(report.action).toBe('installed');
    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod/module.yaml'))).toBe(true);
  }, 30_000);
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
      moduleAdd(
        ctx,
        'acme-mod',
        'npm:not-a-valid-spec',
        installOptions({ workDir: await tempDir('forge-module-npm-') }),
      ),
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
    await expect(moduleUpdate(ctx, 'not-real', '/nowhere', installOptions())).rejects.toMatchObject(
      { code: 'KB-015' },
    );
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
    await overlayAdd(
      { paths: project.paths },
      overlayDir,
      installOptions({ consent: { yes: true } }),
    );

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
    await overlayAdd(
      { paths: project.paths },
      overlayDir,
      installOptions({ consent: { yes: true } }),
    );

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

  it("refuses immediately (CFG-047) when the lock names this process's own still-alive pid", async () => {
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

  // Regression for a CONFIRMED round-2 critic finding, a real bug in the round-1 fix above:
  // `withManifestLock`'s own ambiguous-retry branch (`existingPid === undefined`) used to have NO
  // delay and NO age-gate at all. `migrate/lock.ts`'s own `acquireMigrateLock` is the sibling with the
  // FULL fix (a genuine age-gated self-heal) this module now mirrors via its own
  // `AMBIGUOUS_LOCK_GRACE_MS`. `run/lock.ts`'s own `AMBIGUOUS_LOCK_RETRY_DELAY_MS` lent only its
  // naming convention for the fixed retry delay, NOT the self-heal mechanism itself -- `run/lock.ts`
  // deliberately has no age-gate at all for its own ambiguous case (see `acquireRunLock`'s own
  // disclosure comment). A critic constructed exactly the scenario below -- a
  // permanently-malformed-but-stably-readable lock file (non-numeric content, a realistic
  // disk-corruption/hand-edit scenario) -- and confirmed: pre-fix, this burned through all
  // `MAX_LOCK_ATTEMPTS` in ~7ms, every time, throwing `CFG-047` forever with zero backoff and zero
  // self-heal path. Fixed the identical way `migrate/lock.ts`'s own `acquireMigrateLock` already
  // proves safe: age-gated on the lock FILE's own measured `mtime`, so this must now take measurably
  // LONGER than an instant (past its own `AMBIGUOUS_LOCK_GRACE_MS`) before it self-heals, rather than
  // either failing permanently or reclaiming unsafely on sight.
  it('a permanently-malformed-but-readable lock (non-numeric content) self-heals after its own grace period, never failing instantly and never reclaiming on sight', async () => {
    const project = await createTestProject();
    const lockPath = project.paths.resolveState('module-install.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    // Non-numeric: `readLockPid`'s own `Number.isInteger` check always reads this as ambiguous
    // (`undefined`), never as a real, parseable pid -- simulating a hand-edited or corrupted lock
    // file that will NEVER become parseable on its own, unlike an ordinary in-flight TOCTOU gap.
    await writeFile(lockPath, 'not-a-pid-corrupted-lock-content');

    const start = Date.now();
    const result = await withManifestLock(project.paths, () => Promise.resolve('acquired'));
    const elapsedMs = Date.now() - start;

    expect(result).toBe('acquired');
    // The real, load-bearing assertion: this took measurably longer than an instant (the pre-fix
    // ~7ms failure) -- proof the ambiguous lock was retried/age-gated, not reclaimed on sight, and
    // not failed fast with a permanent CFG-047.
    expect(elapsedMs).toBeGreaterThan(1000);
    // And it must not still be sitting there unresolved past this call -- the self-heal actually
    // reclaimed the stale file and released its own newly-acquired lock afterward.
    expect(existsSync(lockPath)).toBe(false);
  }, 10_000);
});

/**
 * `withManifestLock`'s own write-time fencing — the identical anomaly-injection technique
 * `collection-lock.test.ts`'s own top doc comment establishes, ported here: directly reassigning the
 * lock file to a different real pid mid-operation stands in for the confirmed double-`wx`-create race
 * this mechanism exists to close, without needing to trigger that real OS-level race itself.
 *
 * Framed around the EARLY write point specifically (`moduleAddLocked`/`moduleUpdateLocked`'s own
 * `installBundleTree` call, `moduleRemoveLocked`'s own `rm(destAbs, ...)` call) — a round-2 critic
 * finding: this fence check did not exist at all before this round, only the LATER one (immediately
 * before `writeManifestDocument`) did. The mechanism itself (a lost fence aborts `fn()` and
 * `withManifestLock` re-enters its full acquire-and-`fn()` loop from scratch) is identical regardless
 * of which of the two fenced points inside `fn()` detects the loss, so this doubles as the dedicated
 * test for `withManifestLock`'s own general fence-loss retry path too — zero dedicated test existed
 * for either before this round (round 1 verified it only by inspection and analogy).
 */
describe('withManifestLock — write-time fencing at the EARLY write point (round-2 critic: installBundleTree/rm were unfenced)', () => {
  it('WITHOUT a fence check at the early write point: a lock file reassigned to a different process mid-operation lets a stale write silently overwrite a concurrent write (the exact confirmed data-loss shape, counterfactual)', async () => {
    const project = await createTestProject();
    const dataPath = project.paths.resolveState('shared.json');
    const lockPath = project.paths.resolveState('module-install.lock');
    const rivalPid = await realDeadPid();

    await withManifestLock(project.paths, () => {
      writeFileSync(dataPath, JSON.stringify(['seed']));
      return Promise.resolve();
    });

    // One full `withManifestLock` call whose own `fn` deliberately does NOT call `verifyFence` before
    // its own early write -- reproducing, on purpose, exactly the vulnerable shape this round's fix 2
    // closes (every real `module.ts`/`overlay.ts` call site DOES call it now; this is the
    // counterfactual proving why it was needed).
    await withManifestLock(project.paths, () => {
      const before = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];

      // THE INJECTED ANOMALY: between this process's own read above and its write below, the
      // confirmed real race fires -- another process's own independently-successful `wx` create
      // lands, that other process performs its own full read-modify-write of the SAME shared file,
      // then releases.
      writeFileSync(lockPath, String(rivalPid));
      const concurrentWrite = [...before, 'concurrent-writer-entry'];
      writeFileSync(dataPath, JSON.stringify(concurrentWrite));
      writeFileSync(lockPath, String(process.pid)); // the rival "hands back" the lock file

      // No `verifyFence()` call here -- the pre-fix-2 shape for the early write point. This process
      // now commits its OWN candidate, computed from the STALE `before` read, clobbering the
      // concurrent writer's entry outright.
      const staleCandidate = [...before, 'this-process-entry'];
      writeFileSync(dataPath, JSON.stringify(staleCandidate));
      return Promise.resolve();
    });

    const final = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];
    // THE BUG, DIRECTLY DEMONSTRATED: the concurrent writer's own entry is gone.
    expect(final).not.toContain('concurrent-writer-entry');
    expect(final).toContain('this-process-entry');
  });

  it('WITH the fence check at the early write point: the identical injected anomaly is detected, the stale write never lands, and a full re-acquire-and-recompute preserves BOTH writers instead of losing one', async () => {
    const project = await createTestProject();
    const dataPath = project.paths.resolveState('shared.json');
    const lockPath = project.paths.resolveState('module-install.lock');
    const rivalPid = await realDeadPid();

    await withManifestLock(project.paths, () => {
      writeFileSync(dataPath, JSON.stringify(['seed']));
      return Promise.resolve();
    });

    let callCount = 0;
    const result = await withManifestLock(project.paths, async (verifyFence) => {
      callCount += 1;
      const before = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];

      if (callCount === 1) {
        // THE IDENTICAL INJECTED ANOMALY as the test above.
        writeFileSync(lockPath, String(rivalPid));
        const concurrentWrite = [...before, 'concurrent-writer-entry'];
        writeFileSync(dataPath, JSON.stringify(concurrentWrite));

        // THE FIX (fix 2): `verifyFence` is called immediately before the early write would commit
        // (standing in for `installBundleTree`/`rm(destAbs, ...)`), and it must throw -- this process
        // can no longer prove it holds the lock.
        await expect(verifyFence()).rejects.toThrow(ManifestLockFenceLostError);

        // The lock file still names the rival, not this process -- release it now (standing in for
        // that other, real process genuinely finishing and releasing on its own), so the retry
        // below's own fresh acquire can win it honestly.
        await rm(lockPath, { force: true });

        // Propagate the SAME error `verifyFence` itself threw -- exactly what a real call site does
        // (`moduleAddLocked`/`moduleUpdateLocked`/`moduleRemoveLocked`/`overlayAddLocked` never
        // swallow a fence loss, never retry just the write).
        throw new ManifestLockFenceLostError();
      }

      // SECOND call (the full re-acquire this fix exists to force): must see the CONCURRENT writer's
      // entry that landed during the first attempt -- proof this is a genuinely fresh read (and, for
      // the real `installBundleTree` call site, a genuinely fresh `fn()` invocation that re-fetches
      // the bundle and re-runs the install from scratch), not a replay of stale data.
      expect(before).toContain('concurrent-writer-entry');
      await verifyFence();
      const candidate = [...before, 'this-process-entry'];
      writeFileSync(dataPath, JSON.stringify(candidate));
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(callCount).toBe(2);
    const final = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];
    // THE FIX, DIRECTLY DEMONSTRATED: neither writer's entry is lost.
    expect(final).toContain('concurrent-writer-entry');
    expect(final).toContain('this-process-entry');
  });

  it('verifyFence passes silently when nothing has disturbed the lock (the ordinary, overwhelmingly common case)', async () => {
    const project = await createTestProject();
    let fenceCalls = 0;
    const result = await withManifestLock(project.paths, async (verifyFence) => {
      await verifyFence();
      fenceCalls += 1;
      await verifyFence();
      fenceCalls += 1;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(fenceCalls).toBe(2);
  });

  it('a genuine, unrelated fn failure still releases the lock normally (fencing never changes ordinary error handling)', async () => {
    const project = await createTestProject();
    await expect(
      withManifestLock(project.paths, () => {
        throw new RangeError('unrelated failure');
      }),
    ).rejects.toThrow(RangeError);

    // The lock must have been released despite the failure -- a second call must acquire cleanly and
    // quickly, not wait out a lock this process itself failed to release.
    const result = await withManifestLock(project.paths, () => Promise.resolve('reacquired'));
    expect(result).toBe('reacquired');
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

// `PLAN-M14.md` P22: the seven shipped module check files gain a real `appliesTo`/`severity`, so
// installing a real, shipped module through `forge module add` attaches its own checks to a real gate
// for real (`loadGateRegistry`, `PLAN-M14.md` P20) -- `gate check`/`gate list` are the real, unmodified
// `@forge/cli/commands/run/gate-commands.ts` entry points a real `forge gate check`/`gate list` uses.
describe('a real shipped module attaches its checks through a real gate (PLAN-M14.md P22)', () => {
  const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

  function gateCtxFor(project: TestProject): GateCommandContext {
    return {
      paths: project.paths,
      projectRoot: project.dir,
      checksRoot: '.forge/checks',
      agentsRoot: '.forge/agents',
      runId: 'test-run',
    };
  }

  it('forge module add fm-web attaches a11y:audit/bundle:size to the real G-Verify gate -- gate list shows both with source, gate check runs both (each fails with its own reason on a project with no dist/)', async () => {
    const project = await createTestProject();
    // fm-web's own module.yaml declares `requires: [fm-core]`.
    await moduleAdd(
      ctxFor(project),
      'fm-core',
      path.join(REAL_MODULES_DIR, 'fm-core'),
      installOptions({ consent: { yes: true } }),
    );
    await moduleAdd(
      ctxFor(project),
      'fm-web',
      path.join(REAL_MODULES_DIR, 'fm-web'),
      installOptions({ consent: { yes: true } }),
    );

    const gates = await gateList(gateCtxFor(project));
    const verify = gates.find((gate) => gate.id === 'G-Verify');
    const a11y = verify?.checks.deterministic.find((check) => check.id === 'a11y:audit');
    const bundle = verify?.checks.deterministic.find((check) => check.id === 'bundle:size');
    expect(a11y).toMatchObject({
      id: 'a11y:audit',
      source: 'modules/fm-web/checks/a11y.check.yaml',
    });
    expect(bundle).toMatchObject({
      id: 'bundle:size',
      source: 'modules/fm-web/checks/bundle-size.check.yaml',
    });

    const report = await gateCheck(gateCtxFor(project), 'G-Verify');
    expect(report.passed).toBe(false);
    const a11yResult = report.checks.find((check) => check.checkId === 'a11y:audit');
    const bundleResult = report.checks.find((check) => check.checkId === 'bundle:size');
    // A fresh project has no `dist/`: both checks give a REAL verdict (their own `failOn` genuinely
    // fired on cleanly-parsed output, `errors: 1` -- `DeterministicCheckResult.reason` is reserved for a
    // fail-CLOSED reason, e.g. an unparseable/refused output, never populated here), and each printed
    // its own stated `reason` naming the missing dist/ directory (`10` §10.3, `PLAN-M13.md` P35/P41: "a
    // check must positively show success").
    expect(a11yResult?.passed).toBe(false);
    expect(a11yResult?.reason).toBeUndefined();
    expect(JSON.parse(a11yResult?.stdout ?? '{}')).toMatchObject({
      errors: 1,
      reason: expect.stringContaining('no dist/ directory found') as unknown,
    });
    expect(bundleResult?.passed).toBe(false);
    expect(bundleResult?.reason).toBeUndefined();
    expect(JSON.parse(bundleResult?.stdout ?? '{}')).toMatchObject({
      errors: 1,
      reason: expect.stringContaining('no dist/ directory found') as unknown,
    });
  });

  // `PLAN-M14.md` P22's own mutation evidence: `bundle:size` pointed at `G-Deliver` (a real, different
  // shipped gate) instead of `G-Verify` -- `gate list` must show it attached where its OWN `appliesTo`
  // now names, never where this piece's own content proposal originally placed it.
  it('bundle:size re-pointed at G-Deliver attaches there instead of G-Verify (gate list reflects the check file, not a cached assumption)', async () => {
    const project = await createTestProject();
    const real = YAML.parse(
      await readFile(path.join(REAL_MODULES_DIR, 'fm-web/checks/bundle-size.check.yaml'), 'utf8'),
    ) as { appliesTo: { gates: readonly string[] } } & Record<string, unknown>;
    const repointed = { ...real, appliesTo: { gates: ['G-Deliver'] } };

    await writeFile(
      project.paths.resolveWithin('.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-web\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await mkdir(project.paths.resolveWithin('.forge/modules/fm-web/checks'), { recursive: true });
    await writeFile(
      project.paths.resolveWithin('.forge/modules/fm-web/checks/bundle-size.check.yaml'),
      YAML.stringify(repointed),
    );
    // `a11y.check.yaml` stays unmutated, still real, still naming `G-Verify` for real.
    await writeFile(
      project.paths.resolveWithin('.forge/modules/fm-web/checks/a11y.check.yaml'),
      await readFile(path.join(REAL_MODULES_DIR, 'fm-web/checks/a11y.check.yaml'), 'utf8'),
    );

    const gates = await gateList(gateCtxFor(project));
    const verify = gates.find((gate) => gate.id === 'G-Verify');
    const deliver = gates.find((gate) => gate.id === 'G-Deliver');
    expect(verify?.checks.deterministic.some((check) => check.id === 'bundle:size')).toBe(false);
    expect(deliver?.checks.deterministic.find((check) => check.id === 'bundle:size')).toMatchObject(
      {
        id: 'bundle:size',
        source: 'modules/fm-web/checks/bundle-size.check.yaml',
      },
    );
    // `a11y:audit` is untouched: still on G-Verify, proving the mutation is isolated to bundle:size alone.
    expect(verify?.checks.deterministic.some((check) => check.id === 'a11y:audit')).toBe(true);
  });
});
