/**
 * `rebuildIndex` — against a real, parsed `fixtures/greenfield-service` `KbTree`.
 *
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteBackend } from '../../src/db/better-sqlite-backend.ts';
import { JsonBackend } from '../../src/db/json-backend.ts';
import { NodeSqliteBackend } from '../../src/db/node-sqlite-backend.ts';
import { rebuildIndex } from '../../src/db/rebuild.ts';
import type { SqliteConnectionLike } from '../../src/db/sqlite-common.ts';
import type { KbIndexBackend } from '../../src/db/types.ts';
import { kbEntrySchema } from '../../src/schema/kb-entry.ts';
import { parseKbTree, type KbTree } from '../../src/schema/tree.ts';

const require = createRequire(import.meta.url);
const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../../../fixtures/greenfield-service');

let scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

type BackendFactory = () => KbIndexBackend;

const BACKENDS: readonly [string, BackendFactory][] = [
  [
    'SqliteBackend',
    () => {
      const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
      return new SqliteBackend(new Database(':memory:'));
    },
  ],
  [
    'NodeSqliteBackend',
    () => {
      const { DatabaseSync } = require('node:sqlite') as {
        DatabaseSync: new (path: string) => SqliteConnectionLike;
      };
      return new NodeSqliteBackend(new DatabaseSync(':memory:'));
    },
  ],
  [
    'JsonBackend',
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-rebuild-'));
      scratchDirs.push(dir);
      return new JsonBackend(path.join(dir, 'index.json'));
    },
  ],
];

describe.each(BACKENDS)('rebuildIndex — %s', (_name, createBackend) => {
  it('finds the real fixture entry for a query matching its own statement', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const backend = createBackend();

    rebuildIndex(tree, backend);

    const hits = backend.search('transactional database');
    expect(hits.map((hit) => hit.id)).toContain('KB-ARCH-0001');
    backend.close();
  });

  it('running rebuildIndex twice from the same tree produces identical search results', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const backend = createBackend();

    rebuildIndex(tree, backend);
    const first = backend.search('transactional database');
    rebuildIndex(tree, backend);
    const second = backend.search('transactional database');

    expect(second).toEqual(first);
    backend.close();
  });

  it('running rebuildIndex twice from the same tree produces identical expand results', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const backend = createBackend();

    rebuildIndex(tree, backend);
    const first = backend.expand(['KB-ARCH-0001'], 1);
    rebuildIndex(tree, backend);
    const second = backend.expand(['KB-ARCH-0001'], 1);

    expect(second).toEqual(first);
    backend.close();
  });
});

describe('rebuildIndex — same top result across every backend', () => {
  it('returns KB-ARCH-0001 as the top hit for an unambiguous query, regardless of backend', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);

    for (const [, createBackend] of BACKENDS) {
      const backend = createBackend();
      rebuildIndex(tree, backend);
      const hits = backend.search('transactional database');
      expect(hits[0]?.id).toBe('KB-ARCH-0001');
      backend.close();
    }
  });
});

describe('rebuildIndex — links, ADRs, diagrams, runbooks', () => {
  it('links the architecture entry to the diagram it names, though ADRs/diagrams/runbooks have no searchable text of their own', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-rebuild-'));
    scratchDirs.push(dir);
    const backend = new JsonBackend(path.join(dir, 'index.json'));
    rebuildIndex(tree, backend);

    // ADRs/diagrams/runbooks have no statement/rationale (Q53 point 5) so they never surface via
    // search — but they must still be linkable: the architecture entry names DIAG-001 in its own
    // `diagrams` field, so expanding from it must reach the diagram's own id.
    const expanded = backend.expand(['KB-ARCH-0001'], 1);
    expect(expanded).toContain('DIAG-001');
    backend.close();
  });
});

describe('rebuildIndex — a KB entry missing an optional body section', () => {
  it('stores an empty rationale when the entry has no ## Rationale section at all', () => {
    // A legitimate KB entry need not carry all four §8.3 body sections — only ## Verification is
    // ever required, and only when confidence: 'verified'.
    const entry = kbEntrySchema.parse({
      id: 'KB-ARCH-0099',
      type: 'knowledge',
      section: 'architecture',
      title: 'Entry with no Rationale section',
      status: 'active',
      confidence: 'low',
      owner: 'architect',
      sources: [{ kind: 'human', ref: 'test' }],
      created: '2026-01-05',
      updated: '2026-01-05',
      review_by: '2026-04-05',
      supersedes: [],
      superseded_by: null,
      related: [],
      diagrams: [],
      tags: [],
      applies_to: [],
      body: '## Statement\nOnly a statement exists here.\n',
    });
    const tree: KbTree = {
      entries: [{ path: 'architecture/no-rationale.md', kind: 'kb-entry', value: entry }],
      errors: [],
    };
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-rebuild-'));
    scratchDirs.push(dir);
    const backend = new JsonBackend(path.join(dir, 'index.json'));

    rebuildIndex(tree, backend);

    expect(backend.search('statement').map((hit) => hit.id)).toContain('KB-ARCH-0099');
    expect(backend.search('nonexistentrationaleterm')).toEqual([]);
    backend.close();
  });
});
