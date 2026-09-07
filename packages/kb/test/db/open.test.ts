/**
 * `openKbIndex` — `02` §2.1's three-tier fallback, probed in order, never throwing for an
 * unavailable native module.
 *
 * @see specs/02 §2.1
 * @see PLAN-M3.md P8
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import type * as NodeModule from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isForgeError } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-open-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

/** Mocks `node:module` so `createRequire(...)('foo')` throws for every specifier in
 * `blockedSpecifiers`, and otherwise behaves exactly like the real module — simulating "this native
 * binding is unloadable" without actually uninstalling anything. Cast to `Record<string, unknown>`
 * before spreading: `node:module`'s own namespace type includes the `Module` class among its
 * exports, and spreading the *namespace* (not the class itself) still trips a lint rule aimed at the
 * latter. */
function mockNodeModuleRequire(blockedSpecifiers: readonly string[]): void {
  vi.doMock('node:module', async (importOriginal) => {
    const actual = (await importOriginal<typeof NodeModule>()) as unknown as Record<string, unknown>;
    const realCreateRequire = actual['createRequire'] as (url: string | URL) => NodeJS.Require;
    return {
      ...actual,
      createRequire: (url: string | URL) => {
        const realRequire = realCreateRequire(url);
        const fakeRequire = (specifier: string): unknown => {
          if (blockedSpecifiers.includes(specifier)) {
            throw new Error(`simulated unloadable module: ${specifier}`);
          }
          return realRequire(specifier);
        };
        return Object.assign(fakeRequire, realRequire);
      },
    };
  });
  vi.resetModules();
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
  vi.doUnmock('node:module');
  vi.resetModules();
});

describe('openKbIndex — real environment', () => {
  it('picks better-sqlite3 when it is genuinely installed and loadable', async () => {
    const { openKbIndex } = await import('../../src/db/open.ts');
    const { SqliteBackend } = await import('../../src/db/better-sqlite-backend.ts');
    const paths = freshProject();
    const backend = openKbIndex(paths);
    expect(backend).toBeInstanceOf(SqliteBackend);
    backend.close();
  });
});

describe('openKbIndex — with better-sqlite3 made deliberately unloadable', () => {
  it('falls through to node:sqlite without throwing', async () => {
    mockNodeModuleRequire(['better-sqlite3']);

    const { openKbIndex } = await import('../../src/db/open.ts');
    const { NodeSqliteBackend } = await import('../../src/db/node-sqlite-backend.ts');
    const paths = freshProject();
    const backend = openKbIndex(paths);
    expect(backend).toBeInstanceOf(NodeSqliteBackend);
    backend.close();
  });
});

describe('openKbIndex — with both native backends made deliberately unloadable', () => {
  it('falls through to the JSON backend without throwing, and warns', async () => {
    mockNodeModuleRequire(['better-sqlite3', 'node:sqlite']);

    const { openKbIndex } = await import('../../src/db/open.ts');
    const { JsonBackend } = await import('../../src/db/json-backend.ts');
    const paths = freshProject();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const backend = openKbIndex(paths);
    expect(backend).toBeInstanceOf(JsonBackend);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    backend.close();
  });
});

describe('openKbIndex — a pre-existing index.db with an incompatible terms table shape', () => {
  it('falls through to node:sqlite failing, then the JSON backend, rather than propagating a raw fts5 error', async () => {
    const paths = freshProject();

    // Build a real index.db with better-sqlite3's own FTS5 terms table first (the real environment
    // has it installed), then simulate it becoming unavailable — node:sqlite alone cannot self-heal
    // an FTS5 table it has no module for (backends.test.ts covers that directly); this test checks
    // the outer openKbIndex path degrades gracefully instead of surfacing that raw error.
    const { openKbIndex: openReal } = await import('../../src/db/open.ts');
    openReal(paths).close();

    mockNodeModuleRequire(['better-sqlite3']);
    const { openKbIndex } = await import('../../src/db/open.ts');
    const { JsonBackend } = await import('../../src/db/json-backend.ts');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let backend: ReturnType<typeof openKbIndex> | undefined;
    expect(() => {
      backend = openKbIndex(paths);
    }).not.toThrow();
    expect(backend).toBeInstanceOf(JsonBackend);
    warnSpy.mockRestore();
    backend?.close();
  });
});

describe('openKbIndex — a genuine filesystem obstruction, not a missing module', () => {
  it('raises KB-012 rather than a raw ENOENT/EEXIST when .forge/state cannot be created', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-open-obstructed-'));
    projectRoot = root;
    // A plain file sitting where `.forge/state` should be a directory.
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'state'), 'not a directory');

    const { openKbIndex } = await import('../../src/db/open.ts');
    const paths = new ProjectPaths(root);
    let thrown: unknown;
    try {
      openKbIndex(paths);
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-012').toBe(true);
  });

  it('still renders a real message when the underlying failure is not an Error instance', async () => {
    // node:fs's own mkdirSync always throws a real Error in practice — this exercises the defensive
    // fallback for a `catch` clause that (per useUnknownInCatchVariables) can type-theoretically
    // catch anything, the same "mock the contract violation directly" pattern already established
    // for KbIdAllocator.allocate's own RangeError branch.
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof NodeFs>();
      return {
        ...actual,
        mkdirSync: () => {
          // Deliberately violating the real throw-an-Error contract to exercise the non-Error
          // fallback branch a `catch (cause)` clause (per useUnknownInCatchVariables) must handle.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'a non-Error failure';
        },
      };
    });
    vi.resetModules();

    const { openKbIndex } = await import('../../src/db/open.ts');
    const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-open-obstructed-'));
    projectRoot = root;
    let thrown: unknown;
    try {
      openKbIndex(new ProjectPaths(root));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-012' && thrown.message.includes('a non-Error failure')).toBe(
      true,
    );
    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});
