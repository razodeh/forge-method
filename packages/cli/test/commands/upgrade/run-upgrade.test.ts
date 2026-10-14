/**
 * `runUpgrade` — `03` §3.4's own seven-step pipeline: backup -> migrate -> regenerate -> re-doctor,
 * against a real `forge init`-produced project.
 */
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';
import type { Migration, MigratableDocument } from '@forge/schemas/migrations';
import * as YAML from 'yaml';

import { specNew } from '../../../src/commands/spec.ts';
import { withGeneratedHeader } from '../../../src/init/generated-header.ts';
import { sha256 } from '../../../src/init/hash.ts';
import { readPackageVersion } from '../../../src/init/package-root.ts';
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

  // A real project fixture plus two full runUpgrade passes: comfortably inside the suite's 60s
  // default alone, but confirmed (full, unscoped `pnpm test` locally, no elevated NODE_OPTIONS) to
  // time out under the resource contention of the complete monorepo suite running concurrently -- a
  // load-sensitivity issue, not a logic bug (passes cleanly, repeatedly, in isolation). The explicit
  // 120s timeout below is doubled rather than raised globally, so the suite's real 60s
  // hang-detection floor stays tight elsewhere.
  const SLOW_TEST_TIMEOUT_MS = 120_000;

  it(
    'is idempotent: running it twice in a row against an already-current project succeeds both times with an identical version pair',
    async () => {
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
    },
    SLOW_TEST_TIMEOUT_MS,
  );

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

  describe('`PLAN-M14.md` P43: staleFiles/editedFiles/missingFiles classification, decoupled from the version pair', () => {
    const WORKFLOW_REL_PATH = '.forge/workflows/intake.workflow.yaml';

    /** A real, undrifted copy of an *older* shipped body, stamped with the real, currently-running
     * version — the header's own recorded hash matches this file's own on-disk body (a human never
     * touched it), but that body is not what `content.ts` reads today: the real "shipped content
     * changed since this was generated" shape, at the identical real version on both sides (an
     * "equal version pair"), so any real staleness this proves comes from the real body/header hash
     * comparison alone, never from a version-string bump. */
    async function writeStaleWorkflow(project: Awaited<ReturnType<typeof createTestProject>>) {
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      const olderBody = 'id: intake\nsteps: []\n# an older shipped body\n';
      const version = readPackageVersion('@forge/agents');
      const staleContent = withGeneratedHeader(
        olderBody,
        WORKFLOW_REL_PATH,
        version,
        sha256(olderBody),
      );
      await writeFile(filePath, staleContent, 'utf8');
    }

    it('a current project (nothing edited, equal version pair) reports staleFiles/editedFiles empty and regenerated: false', async () => {
      const project = await createTestProject();
      const report = await runUpgrade(
        project.paths,
        project.dir,
        { dryRun: true },
        baseDeps(project),
      );
      expect(report.installedVersion).toBe(report.targetVersion);
      expect(report.staleFiles).toEqual([]);
      expect(report.editedFiles).toEqual([]);
      expect(report.missingFiles).toEqual([]);
      expect(report.regenerated).toBe(false);
    });

    it('reports a real stale file and regenerated: true at an equal version pair (red: regenerated false before PLAN-M14.md P43)', async () => {
      const project = await createTestProject();
      await writeStaleWorkflow(project);

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { dryRun: true },
        baseDeps(project),
      );
      expect(report.installedVersion).toBe(report.targetVersion);
      expect(report.staleFiles).toEqual([WORKFLOW_REL_PATH]);
      expect(report.editedFiles).toEqual([]);
      expect(report.regenerated).toBe(true);
    });

    it('classifies a hand-edited file as editedFiles, not staleFiles, and does NOT force regenerated: true on its own', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      await writeFile(filePath, `${await readFile(filePath, 'utf8')}\n# hand-edited\n`, 'utf8');

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { dryRun: true },
        baseDeps(project),
      );
      expect(report.editedFiles).toEqual([WORKFLOW_REL_PATH]);
      expect(report.staleFiles).toEqual([]);
      expect(report.missingFiles).toEqual([]);
      // Critic round 1 finding: an edit's own resolution can be `keep-mine` (nothing written), so
      // `editedFiles` alone must never force `regenerated: true` the way stale/missing do.
      expect(report.regenerated).toBe(false);
    });

    it('a real, missing regenerable file reports as missingFiles and forces regenerated: true, at an equal version pair, with staleFiles/editedFiles empty (critic round 1 finding)', async () => {
      const project = await createTestProject();
      await rm(path.join(project.dir, WORKFLOW_REL_PATH));

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { dryRun: true },
        baseDeps(project),
      );
      expect(report.installedVersion).toBe(report.targetVersion);
      expect(report.missingFiles).toEqual([WORKFLOW_REL_PATH]);
      expect(report.staleFiles).toEqual([]);
      expect(report.editedFiles).toEqual([]);
      expect(report.regenerated).toBe(true);

      // A real run creates it silently, exactly like a stale file — no conflict resolution.
      const realReport = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
      const created = realReport.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(created?.conflict).toBeUndefined();
      await expect(readFile(path.join(project.dir, WORKFLOW_REL_PATH), 'utf8')).resolves.toContain(
        'forge:generated',
      );
    });

    describe('(specs/22 M16 P9)', () => {
      // A project initialised before M16 has no `G-Parity.gate.yaml` at all (`missingFiles`) and an
      // older `refactor.workflow.yaml` body with no `preflight-parity`/`verify-parity` steps
      // (`staleFiles`) -- both real regenerable-content categories `content.ts` already drives
      // (`GATE_INDEX`/`WORKFLOW_INDEX`), so a real upgrade installs both with no new wiring of its
      // own.
      it('a pre-M16 project (no G-Parity.gate.yaml, an older refactor.workflow.yaml body) installs G-Parity and the edited refactor workflow on a real upgrade', async () => {
        const project = await createTestProject();
        const gateRelPath = '.forge/checks/G-Parity.gate.yaml';
        const refactorRelPath = '.forge/workflows/refactor.workflow.yaml';
        await rm(path.join(project.dir, gateRelPath));
        const olderBody =
          'id: refactor\nname: Refactor\nversion: 1.0.0\ndescription: d\nlevels: [L0]\n' +
          'steps:\n  - id: refactor-code\n    kind: agent\n    agent: backend\n' +
          '# an older shipped body, pre-M16 P9\n';
        const refactorVersion = readPackageVersion('@forge/agents');
        await writeFile(
          path.join(project.dir, refactorRelPath),
          withGeneratedHeader(olderBody, refactorRelPath, refactorVersion, sha256(olderBody)),
          'utf8',
        );

        const dryRun = await runUpgrade(
          project.paths,
          project.dir,
          { dryRun: true },
          baseDeps(project),
        );
        expect(dryRun.missingFiles).toContain(gateRelPath);
        expect(dryRun.staleFiles).toContain(refactorRelPath);
        expect(dryRun.regenerated).toBe(true);

        const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
        expect(report.dryRun).toBe(false);
        const gateFile = report.regeneratedFiles?.find((file) => file.path === gateRelPath);
        const workflowFile = report.regeneratedFiles?.find((file) => file.path === refactorRelPath);
        expect(gateFile?.conflict).toBeUndefined();
        expect(workflowFile?.conflict).toBeUndefined();

        const installedGate = await readFile(path.join(project.dir, gateRelPath), 'utf8');
        expect(installedGate).toContain('id: G-Parity');
        expect(installedGate).toContain('behavior:parity');
        const installedWorkflow = await readFile(path.join(project.dir, refactorRelPath), 'utf8');
        expect(installedWorkflow).toContain('preflight-parity');
        expect(installedWorkflow).toContain('verify-parity');
        expect(installedWorkflow).not.toContain('an older shipped body');
      });
    });

    it('a real run regenerates the stale file silently, and a second dry run reports none', async () => {
      const project = await createTestProject();
      await writeStaleWorkflow(project);
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);

      const realReport = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
      expect(realReport.dryRun).toBe(false);
      expect(realReport.staleFiles).toEqual([WORKFLOW_REL_PATH]);
      const regenerated = realReport.regeneratedFiles?.find(
        (file) => file.path === WORKFLOW_REL_PATH,
      );
      expect(regenerated?.conflict).toBeUndefined();
      expect(await readFile(filePath, 'utf8')).not.toContain('older shipped body');

      const secondDryRun = await runUpgrade(
        project.paths,
        project.dir,
        { dryRun: true },
        baseDeps(project),
      );
      expect(secondDryRun.staleFiles).toEqual([]);
      expect(secondDryRun.regenerated).toBe(false);
    });
  });

  describe('`03` §3.3/§3.4 conflict resolution on a hash-drifted regenerable file (PLAN-M12.md P3)', () => {
    const WORKFLOW_REL_PATH = '.forge/workflows/intake.workflow.yaml';

    it('regenerates an unedited regenerable file silently, no conflict reported', async () => {
      const project = await createTestProject();
      const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow).toMatchObject({ generated: true });
      expect(workflow?.conflict).toBeUndefined();
    });

    it('stamps the real, currently-running @forge/agents version, not a hardcoded schema constant', async () => {
      // A round-1 critic finding: the pre-existing `v=` assertion elsewhere only checked the header's
      // shape ("starts with v="), which passes identically for the old, hardcoded `v=1` literal this
      // piece fixed — a regression back to that literal would not have failed any test.
      const project = await createTestProject();
      await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
      const content = await readFile(path.join(project.dir, WORKFLOW_REL_PATH), 'utf8');
      expect(content).toContain(`# forge:generated v=${readPackageVersion('@forge/agents')} hash=`);
    });

    it('take-theirs overwrites the hand-edited file with the newly generated content', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      await writeFile(filePath, `${await readFile(filePath, 'utf8')}\n# hand-edited\n`);

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { onConflict: 'take-theirs' },
        baseDeps(project),
      );

      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow?.conflict).toBe('take-theirs');
      expect(await readFile(filePath, 'utf8')).not.toContain('# hand-edited');
    });

    it('keep-mine leaves the hand-edited file on disk completely untouched', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      const edited = `${await readFile(filePath, 'utf8')}\n# hand-edited\n`;
      await writeFile(filePath, edited);

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { onConflict: 'keep-mine' },
        baseDeps(project),
      );

      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow?.conflict).toBe('keep-mine');
      expect(await readFile(filePath, 'utf8')).toBe(edited);
    });

    it('merge writes a real sidecar with the new content, leaving the real path exactly as the human left it', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      const edited = `${await readFile(filePath, 'utf8')}\n# hand-edited\n`;
      await writeFile(filePath, edited);

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { onConflict: 'merge' },
        baseDeps(project),
      );

      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow?.conflict).toBe('merge');
      expect(await readFile(filePath, 'utf8')).toBe(edited);
      const sidecar = await readFile(`${filePath}.forge-incoming`, 'utf8');
      expect(sidecar).toContain('forge:generated');
      expect(sidecar).not.toContain('# hand-edited');
    });

    it('a real interactive prompt (no --on-conflict) resolves a real conflict from injected stdin', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      const edited = `${await readFile(filePath, 'utf8')}\n# hand-edited\n`;
      await writeFile(filePath, edited);

      const { PassThrough } = await import('node:stream');
      const input = new PassThrough();
      const output = new PassThrough();
      output.resume();
      const reportPromise = runUpgrade(
        project.paths,
        project.dir,
        {},
        { ...baseDeps(project), conflictInput: input, conflictOutput: output },
      );
      input.write('t\n');
      const report = await reportPromise;

      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow?.conflict).toBe('take-theirs');
    });

    it('show-diff prints a real, sanitized diff before falling back to keep-mine for a non-interactive run', async () => {
      const project = await createTestProject();
      const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
      const edited = `${await readFile(filePath, 'utf8')}\n# hand-edited\n`;
      await writeFile(filePath, edited);

      const { PassThrough } = await import('node:stream');
      const output = new PassThrough();
      let printed = '';
      output.on('data', (chunk: Buffer) => {
        printed += chunk.toString('utf8');
      });

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { onConflict: 'show-diff' },
        { ...baseDeps(project), conflictOutput: output },
      );

      const workflow = report.regeneratedFiles?.find((file) => file.path === WORKFLOW_REL_PATH);
      expect(workflow?.conflict).toBe('keep-mine');
      expect(printed).toContain('hand-edited');
      expect(await readFile(filePath, 'utf8')).toBe(edited);
    });
  });

  describe('`.forge/techniques/` is a regenerable directory too (PLAN-M14.md P29)', () => {
    const TECHNIQUE_REL_PATH = '.forge/techniques/sample.technique.yaml';

    it('reports no drift for an unedited technique file, and take-theirs reports real drift for a hand-edited one', async () => {
      const project = await createTestProject();
      const unedited = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));
      const uneditedFile = unedited.regeneratedFiles?.find(
        (file) => file.path === TECHNIQUE_REL_PATH,
      );
      expect(uneditedFile).toMatchObject({ generated: true });
      expect(uneditedFile?.conflict).toBeUndefined();

      const filePath = path.join(project.dir, TECHNIQUE_REL_PATH);
      await writeFile(filePath, `${await readFile(filePath, 'utf8')}\n# hand-edited\n`);

      const report = await runUpgrade(
        project.paths,
        project.dir,
        { onConflict: 'take-theirs' },
        baseDeps(project),
      );

      const technique = report.regeneratedFiles?.find((file) => file.path === TECHNIQUE_REL_PATH);
      expect(technique?.conflict).toBe('take-theirs');
      expect(await readFile(filePath, 'utf8')).not.toContain('# hand-edited');
      expect(await readFile(filePath, 'utf8')).toContain('id: sample');
    });
  });

  describe('merges missing MANAGED .gitignore entries into an existing project (specs/22 M17 P13) (defect #21a)', () => {
    const GITIGNORE_REL_PATH = '.gitignore';

    /** Simulates a project `forge init`-ed by an older FORGE version, before `.forge/backups/` joined
     * the managed list (`specs/22` M15 P14's own real live-run finding) -- `createTestProject`'s own
     * real `forge init` already wrote every CURRENT managed entry, so stripping the newest one back
     * out is the one real way to produce "an existing project missing a managed entry" without this
     * test needing its own second, hand-maintained copy of the managed list. */
    async function stripBackupsEntry(project: Awaited<ReturnType<typeof createTestProject>>) {
      const gitignorePath = path.join(project.dir, GITIGNORE_REL_PATH);
      const before = await readFile(gitignorePath, 'utf8');
      expect(before).toContain('.forge/backups/');
      await writeFile(gitignorePath, before.replace('.forge/backups/\n', ''), 'utf8');
      return { gitignorePath, before };
    }

    it(
      'a dry run reports the missing managed entry and writes nothing at all',
      async () => {
        const project = await createTestProject();
        const { gitignorePath, before } = await stripBackupsEntry(project);
        const stripped = before.replace('.forge/backups/\n', '');

        const report = await runUpgrade(
          project.paths,
          project.dir,
          { dryRun: true },
          baseDeps(project),
        );

        expect(report.gitignoreEntriesAdded).toEqual(['.forge/backups/']);
        expect(await readFile(gitignorePath, 'utf8')).toBe(stripped);
      },
      // Same load-sensitivity this file's own "is idempotent" test above already documents (a real
      // `forge init` plus a real `runUpgrade` pass, under the resource contention of the full
      // monorepo suite running concurrently) -- reuses the identical, already-justified timeout
      // rather than inventing a second one.
      SLOW_TEST_TIMEOUT_MS,
    );

    it(
      "a real run merges the missing entry back in, preserving the human's own unrelated line untouched",
      async () => {
        const project = await createTestProject();
        const { gitignorePath, before } = await stripBackupsEntry(project);
        const stripped = before.replace('.forge/backups/\n', '');
        await writeFile(gitignorePath, `${stripped}my-own-ignore-rule/\n`, 'utf8');

        const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

        expect(report.gitignoreEntriesAdded).toEqual(['.forge/backups/']);
        const after = await readFile(gitignorePath, 'utf8');
        expect(after).toContain('my-own-ignore-rule/');
        expect(after).toContain('.forge/backups/');
        expect(after).toContain('.forge/state/');
      },
      SLOW_TEST_TIMEOUT_MS,
    );

    it(
      "a real run against a project's own pre-existing # FORGE header never writes a second one -- exactly one block after merging (specs/22 M17 P13, critic round 2 finding 3)",
      async () => {
        // `createTestProject()`'s own real `forge init` already wrote one real `# FORGE` header (the
        // ordinary case every real upgrade actually runs against) -- `stripBackupsEntry` removes only
        // the one managed LINE, the header stays. The pre-M17-P13, single-caller `appendGitignore`
        // only ever ran once per project and could safely assume no header existed yet; this function
        // now also runs here, against a file that already has one.
        const project = await createTestProject();
        const { gitignorePath } = await stripBackupsEntry(project);

        await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

        const after = await readFile(gitignorePath, 'utf8');
        expect(after.split('# FORGE')).toHaveLength(2); // exactly one real occurrence
        expect(after).toContain('.forge/backups/');
      },
      SLOW_TEST_TIMEOUT_MS,
    );

    it(
      'reports an empty gitignoreEntriesAdded and leaves .gitignore byte-identical when every managed entry is already present (idempotent, zero-change)',
      async () => {
        const project = await createTestProject();
        const gitignorePath = path.join(project.dir, GITIGNORE_REL_PATH);
        const before = await readFile(gitignorePath, 'utf8');

        const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

        expect(report.gitignoreEntriesAdded).toEqual([]);
        expect(await readFile(gitignorePath, 'utf8')).toBe(before);
      },
      SLOW_TEST_TIMEOUT_MS,
    );

    it(
      'a real second upgrade with nothing missing does not even rewrite .gitignore -- a real mtime check, not just a content comparison (specs/22 M17 P13, critic round 2 finding 2)',
      async () => {
        // A content-only comparison (the test above) cannot tell "wrote the identical bytes back"
        // apart from "never touched the file at all" -- both leave the string equal. `run-upgrade.ts`'s
        // own doc comment on `gitignoreEntriesAdded`'s plan-guard claims the real no-op explicitly
        // ("keeps a no-change upgrade from touching this file's mtime at all"); this proves that
        // claim with a real stat, the identical `statSync(...).mtimeMs` before/after pattern
        // `packages/kb/test/db/read.test.ts` already establishes for an analogous "this call must not
        // touch the file" guarantee.
        const project = await createTestProject();
        const gitignorePath = path.join(project.dir, GITIGNORE_REL_PATH);
        const beforeMtimeMs = (await stat(gitignorePath)).mtimeMs;

        await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

        expect((await stat(gitignorePath)).mtimeMs).toBe(beforeMtimeMs);
      },
      SLOW_TEST_TIMEOUT_MS,
    );

    it(
      'creates a real .gitignore from nothing when the project has none at all',
      async () => {
        const project = await createTestProject();
        const gitignorePath = path.join(project.dir, GITIGNORE_REL_PATH);
        await rm(gitignorePath);

        const report = await runUpgrade(project.paths, project.dir, {}, baseDeps(project));

        expect(report.gitignoreEntriesAdded.length).toBeGreaterThan(0);
        expect(await readFile(gitignorePath, 'utf8')).toContain('.forge/state/');
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  });
});
