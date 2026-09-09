/**
 * `runUpgrade` — `03` §3.4's own seven-step pipeline: backup -> migrate -> regenerate -> re-doctor,
 * against a real `forge init`-produced project.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';
import type { Migration, MigratableDocument } from '@forge/schemas/migrations';
import * as YAML from 'yaml';

import { specNew } from '../../../src/commands/spec.ts';
import { runUpgrade } from '../../../src/commands/upgrade/run-upgrade.ts';
import type { UpgradeDeps } from '../../../src/commands/upgrade/types.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function baseDeps(project: Awaited<ReturnType<typeof createTestProject>>): UpgradeDeps {
  return {
    modulesDir: project.modulesDir,
    specsRoot: project.config.paths.specs,
    config: project.config,
    env: {},
    processVersion: process.version,
  };
}

describe('runUpgrade', () => {
  it('throws CFG-017 when the project has never been initialized (no real manifest)', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/manifest.yaml'));
    await expect(
      runUpgrade(project.paths, project.dir, {}, baseDeps(project)),
    ).rejects.toMatchObject({ code: 'CFG-017' });
  });

  it('throws CFG-017 (not a raw TypeError) for a real, present but structurally malformed manifest', async () => {
    const project = await createTestProject();
    const manifestPath = path.join(project.dir, '.forge/manifest.yaml');
    await writeFile(manifestPath, 'version: 1\n# no real modules field at all\n');
    await expect(
      runUpgrade(project.paths, project.dir, {}, baseDeps(project)),
    ).rejects.toMatchObject({ code: 'CFG-017' });
  });

  it('throws CFG-018 for a real, explicit downgrade attempt', async () => {
    // Every real workspace package here is currently `0.0.0` (this milestone's own real, undramatic
    // version history — see `PLAN-M6.md` C7's own mandate text), so a genuinely older target needs a
    // manifest hand-raised to a higher installed version first, the only way to make "downgrade" a
    // real, reachable condition rather than an artifact of this project's own current package.json.
    const project = await createTestProject();
    const manifestPath = path.join(project.dir, '.forge/manifest.yaml');
    const raised = YAML.parse(await readFile(manifestPath, 'utf8')) as {
      version: 1;
      modules: { id: string; version: string; checksum: string }[];
    };
    for (const module of raised.modules) module.version = '9.0.0';
    await writeFile(manifestPath, YAML.stringify(raised));

    await expect(
      runUpgrade(project.paths, project.dir, { to: '1.0.0' }, baseDeps(project)),
    ).rejects.toMatchObject({ code: 'CFG-018' });
  });

  it('--dry-run writes nothing at all to the real filesystem', async () => {
    const project = await createTestProject();
    const manifestBefore = await readFile(path.join(project.dir, '.forge/manifest.yaml'), 'utf8');

    const report = await runUpgrade(
      project.paths,
      project.dir,
      { dryRun: true, to: '9.9.9' },
      baseDeps(project),
    );

    expect(report.dryRun).toBe(true);
    expect(report.backupPath).toBeUndefined();
    expect(report.doctor).toBeUndefined();

    const manifestAfter = await readFile(path.join(project.dir, '.forge/manifest.yaml'), 'utf8');
    expect(manifestAfter).toBe(manifestBefore);
    await expect(
      readFile(path.join(project.dir, '.forge/backups'), 'utf8').catch(() => null),
    ).resolves.toBeNull();
  });

  it('a real, full (non-dry-run) upgrade backs up, regenerates, and re-runs doctor', async () => {
    const project = await createTestProject();

    const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

    expect(report.dryRun).toBe(false);
    expect(report.backupPath).toBeDefined();
    expect(report.doctor).toBeDefined();
    expect(report.doctor?.v).toBe(1);

    expect(report.backupPath).toBeDefined();
    const backupManifest = await readFile(
      path.join(project.dir, report.backupPath ?? '', 'manifest.yaml'),
      'utf8',
    );
    expect(backupManifest.length).toBeGreaterThan(0);

    const newManifest = YAML.parse(
      await readFile(path.join(project.dir, '.forge/manifest.yaml'), 'utf8'),
    ) as { readonly version: 1; readonly modules: readonly unknown[] };
    expect(newManifest.version).toBe(1);
  });

  it('is idempotent: running it twice in a row against an already-current project succeeds both times with an identical version pair', async () => {
    // Doesn't assert `doctor.ok` here: a freshly `runInit`-produced fixture project can genuinely
    // fail unrelated real checks (e.g. `kb-lint` against this fixture's own preset-applied KB
    // content, or `git-identity` on a host with no global identity) that have nothing to do with
    // whether the upgrade itself was a clean, idempotent no-op — `run-doctor.test.ts` already covers
    // `runDoctor`'s own real pass/fail semantics directly.
    const project = await createTestProject();
    const first = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
    const second = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
    expect(second.dryRun).toBe(false);
    expect(second.doctor).toBeDefined();
    expect(second.installedVersion).toBe(first.installedVersion);
    expect(second.targetVersion).toBe(first.targetVersion);
    expect(second.migratedDocuments.every((doc) => doc.stepCount === 0)).toBe(true);
  });

  it('degrades honestly (CFG-019) rather than backing up/regenerating over a document with a real chain gap', async () => {
    const project = await createTestProject();
    await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      'A fixture vision',
    );

    // Only the 2->3 step is registered for `Vision` — a real document sitting at schemaVersion 1 has
    // no way to reach schemaVersion 3 (the fixture's own highest declared `to`), a genuine chain gap.
    const gappedMigrations: readonly Migration[] = [
      {
        from: 2,
        to: 3,
        types: ['Vision'],
        description: 'unreachable fixture step',
        reversible: false,
        up: (doc: MigratableDocument) => doc,
      },
    ];

    const manifestBefore = await readFile(path.join(project.dir, '.forge/manifest.yaml'), 'utf8');
    await expect(
      runUpgrade(
        project.paths,
        project.dir,
        {},
        { ...baseDeps(project), migrations: gappedMigrations },
      ),
    ).rejects.toMatchObject({ code: 'CFG-019' });

    // No backup, no manifest rewrite -- the plan step throws before any real write happens.
    const manifestAfter = await readFile(path.join(project.dir, '.forge/manifest.yaml'), 'utf8');
    expect(manifestAfter).toBe(manifestBefore);
  });

  it('falls back to the real, currently-running @forge/agents version when the manifest has no real module row', async () => {
    const project = await createTestProject();
    const manifestPath = path.join(project.dir, '.forge/manifest.yaml');
    // Only the synthetic `@forge/templates` row -- no real module -- forces `installedVersionFrom`'s
    // own `??` fallback.
    await writeFile(
      manifestPath,
      YAML.stringify({
        version: 1,
        modules: [{ id: '@forge/templates', version: '0.0.0', checksum: 'a'.repeat(64) }],
      }),
    );

    const report = await runUpgrade(
      project.paths,
      project.dir,
      { dryRun: true },
      baseDeps(project),
    );
    expect(report.installedVersion).toBe(report.targetVersion);
  });

  it('threads a real, injected PlatformAdapter through to the real re-run of forge doctor', async () => {
    const project = await createTestProject();
    const adapter = new FakePlatformAdapter();
    const report = await runUpgrade(
      project.paths,
      project.dir,
      {},
      { ...baseDeps(project), adapter },
    );
    const platformCheck = report.doctor?.checks.find((check) => check.id === 'platform-adapter');
    expect(platformCheck?.message).not.toContain('No platform adapter is configured');
  });

  it('reports a real, non-empty migratedDocuments list and regenerated: true when a real document needs migrating', async () => {
    const project = await createTestProject();
    await specNew(
      {
        paths: project.paths,
        specsRoot: project.config.paths.specs,
        kbRoot: project.config.paths.kb,
      },
      'Vision',
      'A fixture vision',
    );
    const realMigrations: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'fixture bump',
        reversible: false,
        up: (doc: MigratableDocument) => ({
          ...doc,
          frontmatter: { ...doc.frontmatter, schemaVersion: 2 },
        }),
      },
    ];

    const report = await runUpgrade(
      project.paths,
      project.dir,
      {},
      { ...baseDeps(project), migrations: realMigrations },
    );

    expect(report.regenerated).toBe(true);
    expect(report.migratedDocuments.some((doc) => doc.stepCount > 0)).toBe(true);
  });
});
