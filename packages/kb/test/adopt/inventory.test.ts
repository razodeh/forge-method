/**
 * `runInventory` against real fixture repositories — `PLAN-M10.md` P15's own Checks text: the
 * dependency graph must match the fixture's real, hand-verified import structure, including a
 * genuine, deliberately-constructed cycle.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P15
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runInventory } from '../../src/adopt/inventory.ts';
import { runSurvey } from '../../src/adopt/survey.ts';
import { walkRepository } from '../../src/adopt/walk.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFixtureDir(
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  await populateFixture(dir, files);
  return dir;
}

async function buildNodeFixture(): Promise<string> {
  return makeFixtureDir('forge-kb-adopt-node-', nodeFixtureFiles());
}

async function inventoryFor(rootDir: string) {
  const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
  return runInventory({ rootDir, survey });
}

describe('runInventory — dependency graph, against a hand-verified import structure', () => {
  it('resolves every real relative import to the right module, extension included or not', async () => {
    const rootDir = await buildNodeFixture();
    const { dependencyGraph } = await inventoryFor(rootDir);

    const byModule = new Map(dependencyGraph.nodes.map((node) => [node.module, node.imports]));
    expect(byModule.get('src/index')).toEqual(['src/cycle-a', 'src/routes']);
    expect(byModule.get('src/routes')).toEqual(['src/db']);
    expect(byModule.get('src/db')).toEqual([]);
    expect(byModule.get('src/cycle-a')).toEqual(['src/cycle-b']);
    expect(byModule.get('src/cycle-b')).toEqual(['src/cycle-a']);
    expect(byModule.get('test/index.test')).toEqual([]);
    expect(dependencyGraph.nodes).toHaveLength(6);
  });

  it('finds the real, deliberately-constructed cycle between cycle-a.ts and cycle-b.ts', async () => {
    const rootDir = await buildNodeFixture();
    const { dependencyGraph } = await inventoryFor(rootDir);

    expect(dependencyGraph.cycles).toEqual([['src/cycle-a', 'src/cycle-b', 'src/cycle-a']]);
  });

  it('reports no cycles for a fixture with none', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-acyclic-', {
      'a.ts': "import './b.ts';\nexport const a = 1;\n",
      'b.ts': 'export const b = 1;\n',
    });
    const { dependencyGraph } = await inventoryFor(rootDir);
    expect(dependencyGraph.cycles).toEqual([]);
  });

  it('excludes a bare package import from the internal graph entirely', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-bare-import-', {
      'src/app.ts': "import express from 'express';\nexport const app = express();\n",
    });
    const { dependencyGraph } = await inventoryFor(rootDir);

    expect(dependencyGraph.nodes).toEqual([{ module: 'src/app', imports: [] }]);
    // Deleting the `!specifier.startsWith('.')` guard in `resolveRelativeImport` would make this
    // fixture's only node falsely import a module named "src/express" — this assertion fails if that
    // guard is ever removed or inverted.
    expect(dependencyGraph.nodes.some((node) => node.module.includes('express'))).toBe(false);
  });

  it('resolves an extensionless relative import, and a directory import via its index file', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-resolution-', {
      'src/helpers.ts': 'export const helper = 1;\n',
      // No extension on the specifier: proves the extensionless resolution branch.
      'src/uses-helpers.ts': "import { helper } from './helpers';\nexport { helper };\n",
      'src/lib/index.ts': 'export const fromLib = 1;\n',
      // Imports a directory, not a file: proves the `/index` fallback branch.
      'src/uses-lib.ts': "import { fromLib } from './lib';\nexport { fromLib };\n",
    });
    const { dependencyGraph } = await inventoryFor(rootDir);
    const byModule = new Map(dependencyGraph.nodes.map((node) => [node.module, node.imports]));

    expect(byModule.get('src/uses-helpers')).toEqual(['src/helpers']);
    expect(byModule.get('src/uses-lib')).toEqual(['src/lib/index']);
  });

  it('records a dangling relative import as a real edge to a non-existent module, rather than dropping it', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-dangling-', {
      'src/broken.ts': "import { thing } from './does-not-exist.ts';\nexport { thing };\n",
    });
    const { dependencyGraph } = await inventoryFor(rootDir);
    const byModule = new Map(dependencyGraph.nodes.map((node) => [node.module, node.imports]));

    // `imports.add(match ?? resolvedBase)`: swapping that `??` for `&&` (or dropping the fallback
    // entirely) would silently lose this edge instead of recording the broken import as a fact.
    expect(byModule.get('src/broken')).toEqual(['src/does-not-exist']);
  });
});

describe('runInventory — public API surface', () => {
  it('classifies a plain route as http-route and a "webhook"-named route as webhook', async () => {
    const rootDir = await buildNodeFixture();
    const { publicApiSurface } = await inventoryFor(rootDir);

    expect(publicApiSurface).toEqual(
      expect.arrayContaining([
        {
          kind: 'http-route',
          name: 'GET /health',
          path: 'src/routes.ts',
          evidence: "app.get('/health'",
        },
        {
          kind: 'webhook',
          name: 'POST /webhooks/stripe',
          path: 'src/routes.ts',
          evidence: "app.post('/webhooks/stripe'",
        },
      ]),
    );
  });

  it('finds every real exported symbol across the fixture', async () => {
    const rootDir = await buildNodeFixture();
    const { publicApiSurface } = await inventoryFor(rootDir);

    const exportedNames = publicApiSurface
      .filter((signal) => signal.kind === 'exported-symbol')
      .map((signal) => signal.name)
      .sort();
    expect(exportedNames).toEqual([
      'connect',
      'registerRoutes',
      'startServer',
      'unusedCallsA',
      'valueFromA',
      'valueFromB',
    ]);
  });
});

describe('runInventory — data surface', () => {
  it('finds the migration file under migrations/', async () => {
    const rootDir = await buildNodeFixture();
    const { dataSurface } = await inventoryFor(rootDir);
    expect(dataSurface).toEqual(
      expect.arrayContaining([
        { kind: 'migration', path: 'migrations/0001_init.sql', name: '0001_init.sql' },
      ]),
    );
  });

  it('finds every model in a real prisma schema', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-prisma-', {
      'prisma/schema.prisma': [
        'model User {',
        '  id Int @id @default(autoincrement())',
        '}',
        '',
        'model Post {',
        '  id Int @id @default(autoincrement())',
        '}',
        '',
      ].join('\n'),
    });
    const { dataSurface } = await inventoryFor(rootDir);
    expect(dataSurface).toEqual([
      { kind: 'orm-entity', path: 'prisma/schema.prisma', name: 'User' },
      { kind: 'orm-entity', path: 'prisma/schema.prisma', name: 'Post' },
    ]);
  });
});

describe('runInventory — config surface', () => {
  it('finds every real process.env access, with its 1-based line number', async () => {
    const rootDir = await buildNodeFixture();
    const { configSurface } = await inventoryFor(rootDir);

    const envVars = configSurface.filter((signal) => signal.kind === 'env-var');
    expect(envVars).toEqual(
      expect.arrayContaining([
        { kind: 'env-var', name: 'PORT', path: 'src/routes.ts', line: 6 },
        { kind: 'env-var', name: 'DATABASE_URL', path: 'src/routes.ts', line: 7 },
      ]),
    );
  });

  it('flags a plausible secret reference by name', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-secret-', {
      'src/config.ts': ['export const config = {', '  API_KEY: "shh",', '};', ''].join('\n'),
    });
    const { configSurface } = await inventoryFor(rootDir);
    expect(configSurface).toEqual(
      expect.arrayContaining([
        { kind: 'secret-reference', name: 'API_KEY', path: 'src/config.ts', line: 2 },
      ]),
    );
  });

  it('scans a literal .env file — the real, single most common secrets filename', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-dotenv-', {
      '.env': ['DATABASE_URL=postgres://localhost/app', 'STRIPE_SECRET_KEY=sk_test_123', ''].join(
        '\n',
      ),
    });
    const { configSurface } = await inventoryFor(rootDir);
    expect(configSurface).toEqual(
      expect.arrayContaining([
        { kind: 'secret-reference', name: 'STRIPE_SECRET_KEY', path: '.env', line: 2 },
      ]),
    );
  });

  it('scans a .env.production variant, not only bare .env', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-dotenv-variant-', {
      '.env.production': 'API_KEY=prod-secret\n',
    });
    const { configSurface } = await inventoryFor(rootDir);
    expect(configSurface).toEqual(
      expect.arrayContaining([
        { kind: 'secret-reference', name: 'API_KEY', path: '.env.production', line: 1 },
      ]),
    );
  });
});

describe('runInventory — external dependencies', () => {
  it('lists every real dependency and devDependency from package.json', async () => {
    const rootDir = await buildNodeFixture();
    const { externalDependencies } = await inventoryFor(rootDir);
    expect(externalDependencies).toEqual([
      { name: 'express', version: '^4.18.0', ecosystem: 'npm' },
      { name: 'vitest', version: '^1.0.0', ecosystem: 'npm' },
    ]);
  });
});

describe('runInventory — bounded reads and malformed manifests', () => {
  it('skips a .ts file too large to read, across every extractor, without crashing', async () => {
    const filler = `// ${'x'.repeat(510_000)}\n`;
    const rootDir = await makeFixtureDir('forge-kb-adopt-oversized-ts-', {
      'src/big.ts': `${filler}export function bigFn() {}\napp.get('/big', () => undefined);\n`,
    });
    const { dependencyGraph, publicApiSurface, configSurface } = await inventoryFor(rootDir);

    // The node still exists (the file was walked), but with no imports resolved from its own
    // (unread) content.
    expect(dependencyGraph.nodes).toEqual([{ module: 'src/big', imports: [] }]);
    expect(publicApiSurface).toEqual([]);
    expect(configSurface).toEqual([]);
  });

  it('reports no external dependency when a dependencies field is not an object', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-malformed-manifest-', {
      'package.json': JSON.stringify({ dependencies: 'not-an-object' }),
    });
    const { externalDependencies } = await inventoryFor(rootDir);
    expect(externalDependencies).toEqual([]);
  });

  it('records undefined, not a crash, for a dependency whose version value is not a string', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-weird-version-', {
      'package.json': JSON.stringify({ dependencies: { foo: { workspace: true } } }),
    });
    const { externalDependencies } = await inventoryFor(rootDir);
    expect(externalDependencies).toEqual([{ name: 'foo', version: undefined, ecosystem: 'npm' }]);
  });
});

describe('runInventory — accepts a pre-computed walk', () => {
  it('uses the supplied files list instead of walking rootDir again', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-shared-walk-', {
      'migrations/0001_init.sql': 'CREATE TABLE users (id SERIAL PRIMARY KEY);\n',
    });
    const files = await walkRepository(rootDir);
    // Removed from disk *after* the walk: if runInventory walked again itself, this fact would
    // vanish (the migration signal needs only the path/basename, not the file's own content, to
    // rule out a false pass caused by re-reading a since-deleted file rather than re-walking).
    // Supplying the already-computed `files` list must make it survive.
    await rm(path.join(rootDir, 'migrations', '0001_init.sql'), { force: true });

    const { survey } = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE, files });
    const { dataSurface } = await runInventory({ rootDir, survey, files });
    expect(dataSurface).toEqual([
      { kind: 'migration', path: 'migrations/0001_init.sql', name: '0001_init.sql' },
    ]);
  });
});
