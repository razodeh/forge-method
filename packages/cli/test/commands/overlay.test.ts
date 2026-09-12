/**
 * `forge overlay explain <id>` — a thin wrapper over `@forge/extensions/compile`'s `explainOverlay`.
 * `forge overlay add <source>` (`19` §19.5, `PLAN-M11.md` P5).
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
// Test-only — see `module.test.ts`'s identical note on this exemption.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { compile, type CompileSources } from '@forge/extensions/compile';

import { moduleAdd, readManifestDocument, type InstallOptions } from '../../src/commands/module.ts';
import { overlayAdd, overlayExplain, type OverlayCommandContext } from '../../src/commands/overlay.ts';
import { cleanupAll, createTestProject, registerCleanup } from './upgrade/helpers.ts';

afterEach(cleanupAll);

const FORGE_VERSION = '1.4.0';

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

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  registerCleanup(dir);
  return dir;
}

interface OverlayBundleOverrides {
  readonly id?: string;
  readonly version?: string;
  readonly forgeVersion?: string;
  readonly requiresModules?: readonly string[];
  readonly rogueSkillBody?: string;
}

async function writeOverlayBundle(dir: string, overrides: OverlayBundleOverrides = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'overlay.yaml'),
    YAML.stringify({
      id: overrides.id ?? 'acme-standards',
      name: 'Acme Standards',
      version: overrides.version ?? '1.0.0',
      forgeVersion: overrides.forgeVersion ?? '>=1.0 <2',
      requiresModules: overrides.requiresModules ?? [],
      provides: {},
      requestsCapabilities: [{ network: ['artifactory.internal'] }],
    }),
  );
  if (overrides.rogueSkillBody !== undefined) {
    const skillDir = path.join(dir, 'skills', 'rogue');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---\nid: rogue\nname: Rogue\n---\n${overrides.rogueSkillBody}\n`,
    );
  }
}

const SOURCES: CompileSources = {
  agents: {
    backend: [
      { layer: 'L0', source: 'built-in', document: { persona: { voice: 'neutral' } } },
      { layer: 'L3', source: 'project', document: { persona: { voice: 'blunt' } } },
    ],
  },
  workflows: {},
  frameworks: {},
  templates: {},
  checks: {},
  skills: {},
};

describe('overlayExplain', () => {
  it('names the real, true supplying layer for a real multi-layer entity', () => {
    const result = compile(SOURCES);
    expect(overlayExplain(result, 'agents', 'backend')).toEqual([
      { path: 'persona.voice', layer: 'L3' },
    ]);
  });
});

describe('overlayAdd', () => {
  function ctxFor(project: { readonly paths: OverlayCommandContext['paths'] }): OverlayCommandContext {
    return { paths: project.paths };
  }

  it('installs a real local overlay bundle end to end: manifest row, .forge/overlays content', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { id: 'acme-standards' });

    const report = await overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } }));

    expect(report).toMatchObject({
      id: 'acme-standards',
      action: 'installed',
      version: '1.0.0',
      resolvedSetDelta: { added: ['acme-standards'], removed: [] },
    });
    expect(report.newGrants).toEqual(['Reach network host "artifactory.internal"']);
    expect(existsSync(path.join(project.dir, '.forge/overlays/acme-standards/overlay.yaml'))).toBe(
      true,
    );

    const manifest = await readManifestDocument(project.paths);
    const row = manifest.overlays.find((overlay) => overlay.id === 'acme-standards');
    expect(row).toMatchObject({ id: 'acme-standards', version: '1.0.0', source: bundleDir });
  });

  it('refuses an id already installed as a module or overlay (CFG-042)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { id: 'fixture-mod' });

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-042' });
  });

  it('refuses an overlay.yaml missing a required field (CFG-046)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, 'overlay.yaml'), YAML.stringify({ name: 'No id' }));

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-046' });
  });

  it('refuses an id shaped as a path (CFG-046), never reaching the consent screen or a write', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { id: 'a/b' });

    // No `consent` option at all -- proves the id check runs before consent would ever be reached
    // (an interactive prompt with no `--yes`/`--json` would hang a test that got this far).
    await expect(overlayAdd(ctx, bundleDir, installOptions())).rejects.toMatchObject({
      code: 'CFG-046',
    });
    expect(existsSync(path.join(project.dir, '.forge/overlays/a'))).toBe(false);
  });

  it('refuses when forgeVersion does not admit the running version (CFG-024)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { forgeVersion: '>=2.0 <3' });

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-024' });
  });

  it('refuses when requiresModules names a module not currently installed (CFG-022)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { requiresModules: ['fm-service'] });

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('succeeds when requiresModules names a module that is currently installed', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, { requiresModules: ['fixture-mod'] });

    const report = await overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } }));
    expect(report.action).toBe('installed');
  });

  it('refuses on consent refusal (CFG-040), leaving manifest and .forge/ untouched', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir);
    const before = await readManifestDocument(project.paths);

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { json: true } })),
    ).rejects.toMatchObject({ code: 'CFG-040' });

    expect(existsSync(path.join(project.dir, '.forge/overlays/acme-standards'))).toBe(false);
    expect(await readManifestDocument(project.paths)).toEqual(before);
  });

  it('refuses a bundle whose skill body fails the static safety scan (CFG-037)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await writeOverlayBundle(bundleDir, {
      rogueSkillBody: 'Contains a real secret: AKIAABCDEFGHIJKLMNOP in plain text.',
    });

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-037' });
    expect(existsSync(path.join(project.dir, '.forge/overlays/acme-standards'))).toBe(false);
  });

  it('refuses a bundle that is really a module (CFG-043)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      path.join(bundleDir, 'module.yaml'),
      YAML.stringify({
        id: 'acme-mod',
        name: 'Acme',
        version: '1.0.0',
        forgeVersion: '>=1.0 <2',
        requires: [],
        conflicts: [],
        levels: ['L1'],
        ceilings: {},
        provides: {},
      }),
    );

    await expect(
      overlayAdd(ctx, bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-043' });
  });

  it('reaches the real npm-spec parser for an npm: source (proves channel dispatch)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    await expect(
      overlayAdd(
        ctx,
        'npm:not-a-valid-spec',
        installOptions({ workDir: await tempDir('forge-overlay-npm-') }),
      ),
    ).rejects.toMatchObject({ code: 'CFG-029' });
  });
});

// Exercises `moduleAdd` alongside `overlayAdd` against the same manifest, proving the two share one
// `manifest.yaml` document without clobbering each other's own section.
describe('overlayAdd and moduleAdd share one manifest', () => {
  it('records both a module row and an overlay row in the same manifest.yaml', async () => {
    const project = await createTestProject();
    const moduleDir = await tempDir('forge-shared-module-');
    await mkdir(moduleDir, { recursive: true });
    await writeFile(
      path.join(moduleDir, 'module.yaml'),
      YAML.stringify({
        id: 'shared-mod',
        name: 'Shared',
        version: '1.0.0',
        forgeVersion: '>=1.0 <2',
        requires: [],
        conflicts: [],
        levels: ['L1'],
        ceilings: {},
        provides: {},
      }),
    );
    await moduleAdd(
      { paths: project.paths, modulesDir: project.modulesDir },
      'shared-mod',
      moduleDir,
      installOptions({ consent: { yes: true } }),
    );

    const overlayDir = await tempDir('forge-shared-overlay-');
    await writeOverlayBundle(overlayDir, { id: 'shared-overlay' });
    await overlayAdd(
      { paths: project.paths },
      overlayDir,
      installOptions({ consent: { yes: true } }),
    );

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'shared-mod')).toBe(true);
    expect(manifest.overlays.some((overlay) => overlay.id === 'shared-overlay')).toBe(true);
  });
});
