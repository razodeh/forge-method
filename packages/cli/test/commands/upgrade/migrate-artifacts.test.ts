/**
 * `planArtifactMigrations`/`applyArtifactMigrations` — real chain resolution and real application
 * against a synthetic two-migration fixture (`18` §18.6: the real `MIGRATIONS` registry is empty at
 * this milestone, so a fixture is the only way to exercise a real, non-empty chain — the identical
 * "pass a fixture array" precedent `planMigrations` itself already documents).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { readArtifact } from '@forge/core/artifacts';
import type { Migration, MigratableDocument } from '@forge/schemas/migrations';

import { specNew } from '../../../src/commands/spec.ts';
import {
  applyArtifactMigrations,
  planArtifactMigrations,
} from '../../../src/commands/upgrade/migrate-artifacts.ts';
import { cleanupAll, createTestProject, SPECS_ROOT } from './helpers.ts';

afterEach(cleanupAll);

/** A real, minimal two-step chain for `Vision` (1 -> 2 -> 3), each step appending a real, checkable
 * marker to the body — proves both real chain resolution (`planMigrations`) and real sequential
 * application (`applyMigrations`), not merely a schemaVersion bump. */
const FIXTURE_MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    types: ['Vision'],
    description: 'Vision 1 -> 2 fixture',
    reversible: false,
    up: (doc: MigratableDocument) => ({
      ...doc,
      frontmatter: { ...doc.frontmatter, schemaVersion: 2 },
      body: `${doc.body}\n<!-- migrated 1->2 -->`,
    }),
  },
  {
    from: 2,
    to: 3,
    types: ['Vision'],
    description: 'Vision 2 -> 3 fixture',
    reversible: false,
    up: (doc: MigratableDocument) => ({
      ...doc,
      frontmatter: { ...doc.frontmatter, schemaVersion: 3 },
      body: `${doc.body}\n<!-- migrated 2->3 -->`,
    }),
  },
];

describe('planArtifactMigrations', () => {
  it('resolves a real, non-empty chain for a document behind the fixture registry', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, FIXTURE_MIGRATIONS);
    const entry = planned.find((p) => p.doc.path === doc.path);
    expect(entry).toBeDefined();
    expect(entry?.summary.fromSchemaVersion).toBe(1);
    expect(entry?.summary.toSchemaVersion).toBe(3);
    expect(entry?.summary.stepCount).toBe(2);
  });

  it('resolves a real, empty (no-op) plan against the real, currently-empty registry', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, []);
    expect(planned.every((p) => p.summary.stepCount === 0)).toBe(true);
  });

  it('skips a real document whose front matter has no real type/schemaVersion pair, rather than crashing', async () => {
    const project = await createTestProject();
    const relPath = `${SPECS_ROOT}/incomplete.md`;
    await mkdir(path.join(project.dir, SPECS_ROOT), { recursive: true });
    // A real, well-formed YAML mapping (passes `ArtifactDocument.parse`'s own `CFG-007` check) that is
    // nonetheless missing the `type`/`schemaVersion` fields this step needs — the shape a hand-edited
    // or partially-written real file can genuinely be in, distinct from `forge spec validate`'s own,
    // separate concern of flagging it against the full per-type schema.
    await writeFile(path.join(project.dir, relPath), '---\nid: NOTE-001\n---\n\nbody\n');

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, FIXTURE_MIGRATIONS);
    expect(planned.some((p) => p.doc.path === relPath)).toBe(false);
  });

  it('throws CFG-019 for a real, genuine chain gap', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );

    // Only the 2->3 step is registered — schemaVersion 1's own real document has no way to reach 3.
    const gappedMigrations = FIXTURE_MIGRATIONS.filter((migration) => migration.from === 2);
    await expect(
      planArtifactMigrations(project.paths, SPECS_ROOT, gappedMigrations),
    ).rejects.toMatchObject({ code: 'CFG-019' });
  });

  it('throws CFG-019 for a real registry declaring reversible: true with no down()', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );
    const badRegistry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'bad',
        reversible: true,
        up: (d: MigratableDocument) => d,
      },
    ];
    await expect(
      planArtifactMigrations(project.paths, SPECS_ROOT, badRegistry),
    ).rejects.toMatchObject({ code: 'CFG-019' });
  });

  it('throws CFG-019 for a real registry declaring reversible: false with a down()', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );
    const badRegistry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'bad',
        reversible: false,
        up: (d: MigratableDocument) => d,
        down: (d: MigratableDocument) => d,
      },
    ];
    await expect(
      planArtifactMigrations(project.paths, SPECS_ROOT, badRegistry),
    ).rejects.toMatchObject({ code: 'CFG-019' });
  });

  it('throws CFG-019 for a real registry with two migrations claiming the identical step', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );
    const duplicateRegistry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'first',
        reversible: false,
        up: (d: MigratableDocument) => d,
      },
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'second',
        reversible: false,
        up: (d: MigratableDocument) => d,
      },
    ];
    await expect(
      planArtifactMigrations(project.paths, SPECS_ROOT, duplicateRegistry),
    ).rejects.toMatchObject({ code: 'CFG-019' });
  });
});

describe('applyArtifactMigrations', () => {
  it('writes each migrated document back to disk with the real, transformed content', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, FIXTURE_MIGRATIONS);
    await applyArtifactMigrations(project.paths, planned);

    const migrated = await readArtifact(project.paths, doc.path);
    expect(migrated.get(['schemaVersion'])).toBe(3);
    expect(migrated.body).toContain('migrated 1->2');
    expect(migrated.body).toContain('migrated 2->3');
  });

  it('throws CFG-019 (not a bare, unhandled throw) when a real migration step itself fails to apply', async () => {
    const project = await createTestProject();
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );
    const throwingMigrations: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        types: ['Vision'],
        description: 'a fixture step that always fails',
        reversible: false,
        up: () => {
          throw new Error('fixture migration failure');
        },
      },
    ];

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, throwingMigrations);
    await expect(applyArtifactMigrations(project.paths, planned)).rejects.toMatchObject({
      code: 'CFG-019',
    });
  });

  it('leaves an already-at-target document untouched on disk', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: 'docs/forge/kb' },
      'Vision',
      'A fixture vision',
    );

    const planned = await planArtifactMigrations(project.paths, SPECS_ROOT, []);
    await applyArtifactMigrations(project.paths, planned);

    const untouched = await readArtifact(project.paths, doc.path);
    expect(untouched.toString()).toBe(doc.toString());
  });
});
